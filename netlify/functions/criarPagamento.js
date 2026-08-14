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

  // AGORA RECEBEMOS UMA LISTA: numerosSelecionados (ex: [15, 42, 100])
  const { numerosSelecionados, nome, whatsapp } = body;
  const whatsappDigitos = String(whatsapp || "").replace(/\D/g, "");

  if (!numerosSelecionados || !Array.isArray(numerosSelecionados) || numerosSelecionados.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ erro: "Nenhum número selecionado." }) };
  }
  if (!nome || whatsappDigitos.length < 10 || whatsappDigitos.length > 11) {
    return { statusCode: 400, headers, body: JSON.stringify({ erro: "Preencha nome e WhatsApp válido." }) };
  }

  const db = inicializarFirebase();
  const docRef = db.collection("sorteio").doc("reservas");

  // MULTIPLICA O VALOR: R$ 2,00 vezes a quantidade de números
  const valorTotal = PRECO_NUMERO * numerosSelecionados.length;

  try {
    // 1. Verifica e reserva todos os números de forma atômica
    await db.runTransaction(async (t) => {
      const snap = await t.get(docRef);
      const dados = snap.exists ? snap.data().numeros || {} : {};

      // Primeiro verifica se TODOS os escolhidos estão realmente livres
      for (const num of numerosSelecionados) {
        const chave = String(num);
        const atual = dados[chave];
        const aindaValido = atual && atual.status === "pendente" && Date.now() - atual.criadoEm < MINUTOS_EXPIRACAO * 60 * 1000;
        
        if (atual && (atual.status === "pago" || aindaValido)) {
          throw new Error(`INDISPONIVEL`); // Se 1 falhar, cancela tudo
        }
      }

      // Se todos estiverem livres, faz a reserva prévia deles
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

    const emailSintetico = `${whatsappDigitos}@sorteio-brinde.app`;
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const payment = new Payment(client);

    // 2. Gera a cobrança Pix com o valor total somado
    const resultado = await payment.create({
      body: {
        transaction_amount: valorTotal,
        description: `Sorteio - ${numerosSelecionados.length} número(s)`,
        payment_method_id: "pix",
        payer: { email: emailSintetico, first_name: nome },
        notification_url: `${process.env.URL}/.netlify/functions/webhookPagamento`
      },
    });

    const paymentId = resultado.id;
    const dadosPix = resultado.point_of_interaction.transaction_data;

    // 3. Atualiza os números no Firebase atrelando todos eles ao mesmo ID de Pagamento
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
