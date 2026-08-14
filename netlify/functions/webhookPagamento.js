const admin = require("firebase-admin");
const { MercadoPagoConfig, Payment } = require("mercadopago");

function inicializarFirebase() {
  if (!admin.apps.length) {
    const json = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf-8");
    const serviceAccount = JSON.parse(json);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin.firestore();
}

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch {}

    const paymentId = params["data.id"] || (body.data && body.data.id);
    if (!paymentId) return { statusCode: 200, body: "ok" };

    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const payment = new Payment(client);
    const info = await payment.get({ id: paymentId });

    const db = inicializarFirebase();
    const docRef = db.collection("sorteio").doc("reservas");

    if (info.status === "approved") {
      await db.runTransaction(async (t) => {
        const snap = await t.get(docRef);
        const dados = snap.exists ? snap.data().numeros || {} : {};
        let mudou = false;

        // Varrer todos os números e aprovar TODOS que tiverem este mesmo paymentId
        for (const chave in dados) {
          if (dados[chave].paymentId === Number(paymentId)) {
            dados[chave].status = "pago";
            mudou = true;
          }
        }

        if (mudou) t.set(docRef, { numeros: dados }, { merge: true });
      });
    } else if (["cancelled", "rejected", "refunded"].includes(info.status)) {
      await db.runTransaction(async (t) => {
        const snap = await t.get(docRef);
        const dados = snap.exists ? snap.data().numeros || {} : {};
        let mudou = false;

        for (const chave in dados) {
          if (dados[chave].paymentId === Number(paymentId)) {
            delete dados[chave];
            mudou = true;
          }
        }

        if (mudou) t.set(docRef, { numeros: dados }, { merge: true });
      });
    }

    return { statusCode: 200, body: "ok" };
  } catch (err) {
    console.error(err);
    return { statusCode: 200, body: "ok" };
  }
};
