// ============================================================
// SORTEIO — lógica do site (com pagamento Pix via Mercado Pago)
// Estrutura no Firestore:
//   coleção "sorteio" > documento "reservas" > campo "numeros"
//   { "1": { nome, whatsapp, status: "pendente"|"pago", paymentId, criadoEm }, ... }
// ============================================================

const TOTAL_NUMEROS = 5000;
const db = firebase.firestore();
const docRef = db.collection("sorteio").doc("reservas");

const gridEl = document.getElementById("grid");
const statusMsg = document.getElementById("status-msg");
const statTaken = document.getElementById("stat-taken");
const statFree = document.getElementById("stat-free");

const modalOverlay = document.getElementById("modal-overlay");
const modalNumber = document.getElementById("modal-number");
const modalPreco = document.getElementById("modal-preco");
const modalError = document.getElementById("modal-error");
const nameInput = document.getElementById("name-input");
const whatsappInput = document.getElementById("whatsapp-input");
const modalConfirm = document.getElementById("modal-confirm");
const modalClose = document.getElementById("modal-close");

const etapaDados = document.getElementById("etapa-dados");
const etapaPix = document.getElementById("etapa-pix");
const modalNumberPix = document.getElementById("modal-number-pix");
const qrImage = document.getElementById("qr-image");
const btnCopiar = document.getElementById("btn-copiar");
const copiaColaHidden = document.getElementById("copia-cola-hidden");
const pixTimer = document.getElementById("pix-timer");
const pixStatus = document.getElementById("pix-status");

let reservas = {}; // cache local do Firestore
let numeroSelecionado = null;
let cronometro = null;
let listenerPagamento = null;

const meusNumeros = new Set(JSON.parse(localStorage.getItem("meusNumeros") || "[]"));
function salvarMeuNumero(num) {
  meusNumeros.add(String(num));
  localStorage.setItem("meusNumeros", JSON.stringify([...meusNumeros]));
}

// ---------- construir a grade ----------
function construirGrade() {
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= TOTAL_NUMEROS; i++) {
    const btn = document.createElement("button");
    btn.className = "num-btn";
    btn.id = "num-" + i;
    btn.textContent = String(i).padStart(4, "0");
    btn.dataset.num = i;
    btn.addEventListener("click", () => aoClicarNumero(i));
    frag.appendChild(btn);
  }
  gridEl.innerHTML = "";
  gridEl.appendChild(frag);
}

// ---------- aplicar estado visual ----------
function atualizarVisual() {
  let ocupados = 0;
  for (let i = 1; i <= TOTAL_NUMEROS; i++) {
    const btn = document.getElementById("num-" + i);
    if (!btn) continue;
    const item = reservas[String(i)];
    btn.classList.remove("taken", "mine", "pendente");

    if (item && item.status === "pago") {
      ocupados++;
      if (meusNumeros.has(String(i))) {
        btn.classList.add("mine");
        btn.title = "Pago — reservado por você (" + item.nome + ")";
      } else {
        btn.classList.add("taken");
        btn.title = "Pago — reservado por: " + item.nome;
      }
    } else if (item && item.status === "pendente") {
      ocupados++;
      btn.classList.add("pendente");
      btn.title = meusNumeros.has(String(i))
        ? "Aguardando seu pagamento..."
        : "Aguardando pagamento de outra pessoa (pode liberar em instantes)";
    } else {
      btn.title = "Disponível";
    }
  }
  statTaken.textContent = ocupados;
  statFree.textContent = TOTAL_NUMEROS - ocupados;
}

// ---------- clique em um número ----------
function formatarWhatsapp(digitos) {
  if (!digitos) return "";
  if (digitos.length === 11) return `(${digitos.slice(0,2)}) ${digitos.slice(2,7)}-${digitos.slice(7)}`;
  if (digitos.length === 10) return `(${digitos.slice(0,2)}) ${digitos.slice(2,6)}-${digitos.slice(6)}`;
  return digitos;
}

function aoClicarNumero(num) {
  const item = reservas[String(num)];
  if (item && item.status === "pago") {
    statusMsg.textContent = meusNumeros.has(String(num))
      ? `Número ${num} é seu! Pago como "${item.nome}".`
      : `Número ${num} já foi pago por: ${item.nome} (${formatarWhatsapp(item.whatsapp)})`;
    return;
  }
  if (item && item.status === "pendente" && !meusNumeros.has(String(num))) {
    statusMsg.textContent = `Número ${num} está com pagamento pendente de outra pessoa. Tente novamente em alguns minutos.`;
    return;
  }

  numeroSelecionado = num;
  modalNumber.textContent = String(num).padStart(4, "0");
  modalError.textContent = "";
  nameInput.value = "";
  whatsappInput.value = "";
  etapaDados.classList.remove("hidden");
  etapaPix.classList.add("hidden");
  modalOverlay.classList.remove("hidden");
  setTimeout(() => nameInput.focus(), 50);
}

function fecharModal() {
  modalOverlay.classList.add("hidden");
  numeroSelecionado = null;
  if (cronometro) clearInterval(cronometro);
  if (listenerPagamento) listenerPagamento();
}
modalClose.addEventListener("click", fecharModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) fecharModal();
});

// ---------- gerar pagamento Pix ----------
modalConfirm.addEventListener("click", async () => {
  const nome = nameInput.value.trim();
  const whatsappDigitos = whatsappInput.value.replace(/\D/g, "");

  if (!nome) {
    modalError.textContent = "Digite seu nome.";
    return;
  }
  if (whatsappDigitos.length < 10 || whatsappDigitos.length > 11) {
    modalError.textContent = "Digite um WhatsApp válido, com DDD.";
    return;
  }
  if (numeroSelecionado === null) return;

  modalConfirm.disabled = true;
  modalConfirm.textContent = "Gerando Pix...";
  modalError.textContent = "";

  try {
    const resp = await fetch("/.netlify/functions/criarPagamento", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero: numeroSelecionado, nome, whatsapp: whatsappDigitos }),
    });
    const dados = await resp.json();

    if (!resp.ok) {
      modalError.textContent = dados.erro || "Não foi possível gerar o Pix.";
      return;
    }

    salvarMeuNumero(numeroSelecionado);
    mostrarPix(numeroSelecionado, dados);
  } catch (err) {
    console.error(err);
    modalError.textContent = "Erro de conexão. Tente novamente.";
  } finally {
    modalConfirm.disabled = false;
    modalConfirm.textContent = "Gerar Pix";
  }
});

// ---------- mostrar tela do QR code ----------
function mostrarPix(numero, dados) {
  etapaDados.classList.add("hidden");
  etapaPix.classList.remove("hidden");

  modalNumberPix.textContent = String(numero).padStart(4, "0");
  qrImage.src = "data:image/png;base64," + dados.qrCodeBase64;
  copiaColaHidden.value = dados.copiaECola;
  pixStatus.textContent = "Aguardando pagamento...";

  let segundosRestantes = dados.minutosExpiracao * 60;
  atualizarCronometro(segundosRestantes);
  if (cronometro) clearInterval(cronometro);
  cronometro = setInterval(() => {
    segundosRestantes--;
    atualizarCronometro(segundosRestantes);
    if (segundosRestantes <= 0) {
      clearInterval(cronometro);
      pixStatus.textContent = "Tempo esgotado. Feche e escolha o número novamente.";
    }
  }, 1000);

  if (listenerPagamento) listenerPagamento();
  listenerPagamento = docRef.onSnapshot((snap) => {
    const dadosDoc = snap.data();
    const item = dadosDoc && dadosDoc.numeros ? dadosDoc.numeros[String(numero)] : null;
    if (item && item.status === "pago") {
      pixStatus.textContent = "✅ Pagamento confirmado! Número garantido.";
      clearInterval(cronometro);
    }
  });
}

function atualizarCronometro(segundos) {
  if (segundos < 0) segundos = 0;
  const m = Math.floor(segundos / 60).toString().padStart(2, "0");
  const s = (segundos % 60).toString().padStart(2, "0");
  pixTimer.textContent = `Expira em ${m}:${s}`;
}

btnCopiar.addEventListener("click", () => {
  copiaColaHidden.classList.remove("visually-hidden");
  copiaColaHidden.select();
  document.execCommand("copy");
  copiaColaHidden.classList.add("visually-hidden");
  btnCopiar.textContent = "Copiado!";
  setTimeout(() => (btnCopiar.textContent = "Copiar código Pix"), 2000);
});

// ---------- busca / pular pra um número ----------
document.getElementById("search-btn").addEventListener("click", buscarNumero);
document.getElementById("search-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") buscarNumero();
});

function buscarNumero() {
  const val = parseInt(document.getElementById("search-input").value, 10);
  if (!val || val < 1 || val > TOTAL_NUMEROS) {
    statusMsg.textContent = "Digite um número entre 1 e " + TOTAL_NUMEROS + ".";
    return;
  }
  const btn = document.getElementById("num-" + val);
  if (btn) {
    btn.scrollIntoView({ behavior: "smooth", block: "center" });
    btn.style.outline = "3px solid var(--gold)";
    setTimeout(() => (btn.style.outline = ""), 1500);
    const item = reservas[String(val)];
    if (item && item.status === "pago") {
      statusMsg.textContent = `Número ${val} — pago por: ${item.nome} (${formatarWhatsapp(item.whatsapp)})`;
    } else if (item && item.status === "pendente") {
      statusMsg.textContent = `Número ${val} — pagamento pendente.`;
    } else {
      statusMsg.textContent = `Número ${val} está livre.`;
    }
  }
}

// ---------- escutar mudanças em tempo real (grade geral) ----------
docRef.onSnapshot(
  (snap) => {
    reservas = snap.exists ? snap.data().numeros || {} : {};
    atualizarVisual();
  },
  (err) => {
    console.error(err);
    statusMsg.textContent = "Não foi possível conectar ao banco de dados. Confira o firebase-config.js.";
  }
);

// ---------- iniciar ----------
construirGrade();
atualizarVisual();
if (typeof PRECO_NUMERO !== "undefined") {
  modalPreco.textContent = `Valor: R$ ${PRECO_NUMERO.toFixed(2).replace(".", ",")}`;
}
