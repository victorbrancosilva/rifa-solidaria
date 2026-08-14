const admin = require("firebase-admin");

const MINUTOS_EXPIRACAO = 15;

function inicializarFirebase() {
  if (!admin.apps.length) {
    const json = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf-8");
    const serviceAccount = JSON.parse(json);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin.firestore();
}

exports.handler = async () => {
  const db = inicializarFirebase();
  const docRef = db.collection("sorteio").doc("reservas");

  const snap = await docRef.get();
  if (!snap.exists) return { statusCode: 200, body: "ok" };

  const dados = snap.data().numeros || {};
  let mudou = false;

  for (const chave of Object.keys(dados)) {
    const item = dados[chave];
    if (item.status === "pendente" && Date.now() - item.criadoEm > MINUTOS_EXPIRACAO * 60 * 1000) {
      delete dados[chave];
      mudou = true;
    }
  }

  if (mudou) {
    await docRef.set({ numeros: dados }, { merge: false });
  }

  return { statusCode: 200, body: "ok" };
};

