const admin = require("firebase-admin");
const { MercadoPagoConfig, Payment } = require("mercadopago");

// ====== CONFIGURAÇÕES ======
const PRECO_NUMERO = 2.0; // <-- ajuste o preço de cada número aqui (em R$) — deixe igual ao firebase-config.js
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

  const { numero, nome, whatsapp } = body;
  const whatsappDigitos = String(whatsapp || "").replace(/\D/g, "");

  if (!numero || !nome || whatsappDigitos.length < 10 || whatsappDigitos.length > 11) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ erro: "Preencha nome e um WhatsApp válido com DDD." }),
    };
  }
  if (numero < 1 || numero > 5000) {
    return { statusCode: 400, headers, body: JSON.stringify({ erro: "Número inválido." }) };
  }

  const db = inicializarFirebase();
  const docRef = db.collection("sorteio").doc("reservas");
  const chave = String(numero);

  try {
    // Reserva o número de forma atômica, evitando corrida entre duas pessoas
    await db.runTransaction(async (t) => {
      const snap = await t.get(docRef);
      const dados = snap.exists ? snap.data().numeros || {} : {};
      const atual = dados[chave];

      const aindaValido =
        atual &&
        atual.status === "pendente" &&
        Date.now() - atual.criadoEm < MINUTOS_EXPIRACAO * 60 * 1000;

      if (atual && (atual.status === "pago" || aindaValido)) {
        throw new Error("INDISPONIVEL");
      }

      dados[chave] = {
        nome,
        whatsapp: whatsappDigitos,
        status: "pendente",
        paymentId: null,
        criadoEm: Date.now(),
      };
      t.set(docRef, { numeros: dados }, { merge: true });
    });

    // Mercado Pago exige um e-mail de identificação do pagador — como só coletamos
    // WhatsApp, geramos um e-mail sintético a partir do número (não precisa ser real).
    const emailSintetico = `${whatsappDigitos}@sorteio-brinde.app`;

    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const payment = new Payment(client);

    const resultado = await payment.create({
      body: {
        transaction_amount: PRECO_NUMERO,
        description: `Sorteio - número ${numero}`,
        payment_method_id: "pix",
        payer: { email: emailSintetico, first_name: nome },
        notification_url: `${process.env.URL}/.netlify/functions/webhookPagamento`,
        external_reference: chave,
      },
    });

    const paymentId = resultado.id;
    const dadosPix = resultado.point_of_interaction.transaction_data;

    await docRef.set(
      {
        numeros: {
          [chave]: {
            nome,
            whatsapp: whatsappDigitos,
            status: "pendente",
            paymentId,
            criadoEm: Date.now(),
          },
        },
      },
      { merge: true }
    );

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
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ erro: "Esse número já está reservado ou pago." }),
      };
    }
    console.error(err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ erro: "Erro ao gerar o pagamento. Tente novamente." }),
    };
  }
};

