const admin = require("firebase-admin");
const { MercadoPagoConfig, Payment } = require("mercadopago");

const PRECO_NUMERO = 2.0;
const MINUTOS_EXPIRACAO = 15;

function inicializarFirebase() {
  if (!admin.apps.length) {
    const json = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf-8");
    const serviceAccount = JSON.parse(json);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin.firestore();
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ erro: "Método não permitido" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ erro: "Corpo inválido" }) };
  }

  // 1. Extração do e-mail real recebido do frontend
  const { numerosSelecionados, nome, email, whatsapp } = body;
  const whatsappDigitos = String(whatsapp || "").replace(/\D/g, "");

  if (!numerosSelecionados || !Array.isArray(numerosSelecionados) || numerosSelecionados.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ erro: "Nenhum número selecionado." }) };
  }
  
  // 2. Validação atualizada exigindo o e-mail
  if (!nome || !email || whatsappDigitos.length < 10 || whatsappDigitos.length > 11) {
    return { statusCode: 400, headers, body: JSON.stringify({ erro: "Preencha nome, e-mail e WhatsApp válido." }) };
  }

  const db = inicializarFirebase();
  const docRef = db.collection("sorteio").doc("reservas");

  const valorTotal = PRECO_NUMERO * numerosSelecionados.length;

  try {
    await db.runTransaction(async (t) => {
      const snap = await t.get(docRef);
      const dados = snap.exists ? snap.data().numeros || {} : {};

      for (const num of numerosSelecionados) {
        const chave = String(num);
        const atual = dados[chave];
        const aindaValido = atual && atual.status === "pendente" && Date.now() - atual.criadoEm < MINUTOS_EXPIRACAO * 60 * 1000;
        
        if (atual && (atual.status === "pago" || aindaValido)) {
          throw new Error(`INDISPONIVEL`); 
        }
      }

      for (const num of numerosSelecionados) {
        dados[String(num)] = {
          nome,
          whatsapp: whatsappDigitos,
          status: "pendente",
          paymentId: null,
          criadoEm: Date.now(),
        };
      }
      t.set(docRef, { numeros: dados }, { merge: true });
    });

    // 3. Retorno ao uso seguro da variável de ambiente no Netlify
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const payment = new Payment(client);

    const resultado = await payment.create({
      body: {
        transaction_amount: valorTotal,
        description: `Apoio Acadêmico - ${numerosSelecionados.length} cota(s)`,
        payment_method_id: "pix",
        // 4. Envio do e-mail real para o Mercado Pago
        payer: { email: email, first_name: nome },
        notification_url: `${process.env.URL}/.netlify/functions/webhookPagamento`
      },
    });

    const paymentId = resultado.id;
    const dadosPix = resultado.point_of_interaction.transaction_data;

    const numerosParaAtualizar = {};
    for (const num of numerosSelecionados) {
      numerosParaAtualizar[String(num)] = {
        nome,
        whatsapp: whatsappDigitos,
        status: "pendente",
        paymentId: paymentId,
        criadoEm: Date.now(),
      };
    }
    await docRef.set({ numeros: numerosParaAtualizar }, { merge: true });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        paymentId,
        qrCodeBase64: dadosPix.qr_code_base64,
        copiaECola: dadosPix.qr_code,
        minutosExpiracao: MINUTOS_EXPIRACAO,
      }),
    };
  } catch (err) {
    if (err.message === "INDISPONIVEL") {
      return { statusCode: 409, headers, body: JSON.stringify({ erro: "Um ou mais números selecionados não estão mais disponíveis." }) };
    }
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ erro: "Erro ao gerar o pagamento." }) };
  }
};
