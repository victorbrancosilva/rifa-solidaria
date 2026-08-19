// ============================================================
// SORTEIO — lógica do site (MÚLTIPLOS NÚMEROS E EXPIRAÇÃO)
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
const emailInput = document.getElementById("email-input"); // <-- NOVO CAMPO DE EMAIL MAPEADO
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

let reservas = {}; 
let selecionados = new Set();
let cronometro = null;
let listenerPagamento = null;

const meusNumeros = new Set(JSON.parse(localStorage.getItem("meusNumeros") || "[]"));
function salvarMeuNumero(num) {
  meusNumeros.add(String(num));
  localStorage.setItem("meusNumeros", JSON.stringify([...meusNumeros]));
}

// ---------- INJEÇÃO DA BARRA DE CHECKOUT DINÂMICA ----------
const style = document.createElement("style");
style.innerHTML = `
  .num-btn.selecionado {
    background: var(--gold-soft);
    border-color: var(--gold);
    transform: translateY(-2px);
    box-shadow: 0 4px 10px rgba(212,169,79,0.35);
  }
  .checkout-bar {
    position: fixed; bottom: 0; left: 0; right: 0;
    background: var(--ink); color: var(--paper);
    padding: 1rem 1.5rem;
    display: flex; justify-content: space-between; align-items: center;
    z-index: 100;
    transform: translateY(100%); transition: transform 0.3s ease-out;
    box-shadow: 0 -4px 15px rgba(0,0,0,0.2);
  }
  .checkout-bar.visible { transform: translateY(0); }
  #checkout-text { font-family: var(--font-mono); font-size: 0.95rem; }
  #checkout-btn {
    background: var(--gold); color: var(--ink); border: none;
    padding: 0.6rem 1.2rem; border-radius: 6px; font-weight: 700;
    cursor: pointer; font-family: var(--font-body);
  }
  #checkout-btn:hover { background: var(--gold-soft); }
  @media (max-width: 480px) {
    .checkout-bar { flex-direction: column; gap: 0.75rem; text-align: center; }
    #checkout-btn { width: 100%; }
  }
`;
document.head.appendChild(style);

const checkoutBar = document.createElement("div");
checkoutBar.className = "checkout-bar";
checkoutBar.innerHTML = `
  <span id="checkout-text">0 números - R$ 0,00</span>
  <button id="checkout-btn">Pagar Reservas</button>
`;
document.body.appendChild(checkoutBar);

const checkoutText = document.getElementById("checkout-text");
const checkoutBtn = document.getElementById("checkout-btn");

const textoModal = document.querySelector('.modal-eyebrow');
if (textoModal) textoModal.textContent = "Você está reservando o(s) número(s):";

function atualizarBarraCheckout() {
  if (selecionados.size > 0) {
    checkoutBar.classList.add("visible");
    // Defina o PRECO_NUMERO aqui, caso não esteja definido globalmente em outro lugar
    const PRECO_NUMERO = 2.00; // Ajuste para o valor real da sua cota
    const total = selecionados.size * PRECO_NUMERO;
    checkoutText.textContent = `${selecionados.size} número(s) - R$ ${total.toFixed(2).replace('.', ',')}`;
  } else {
    checkoutBar.classList.remove("visible");
  }
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
    btn.classList.remove("taken", "mine", "pendente", "selecionado");

    const expirou = item && item.status === "pendente" && (Date.now() - item.criadoEm > 15 * 60 * 1000);

    if (item && item.status === "pago") {
      ocupados++;
      if (meusNumeros.has(String(i))) {
        btn.classList.add("mine");
        btn.title = "Pago — reservado por você (" + item.nome + ")";
      } else {
        btn.classList.add("taken");
        btn.title = "Pago — reservado por: " + item.nome;
      }
    } else if (item && item.status === "pendente" && !expirou) {
      ocupados++;
      btn.classList.add("pendente");
      btn.title = meusNumeros.has(String(i))
        ? "Aguardando seu pagamento..."
        : "Aguardando pagamento de outra pessoa";
    } else if (selecionados.has(i)) {
      btn.classList.add("selecionado");
      btn.title = "Selecionado por você";
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
    const expirou = (Date.now() - item.criadoEm > 15 * 60 * 1000);
    if (!expirou) {
      statusMsg.textContent = `Número ${num} está pendente. Tente novamente em alguns minutos.`;
      return;
    }
  }

  if (selecionados.has(num)) {
    selecionados.delete(num); 
  } else {
    if (selecionados.size >= 50) {
      statusMsg.textContent = "Você pode selecionar no máximo 50 números por vez.";
      return;
    }
    selecionados.add(num); 
    statusMsg.textContent = "";
  }

  atualizarVisual();
  atualizarBarraCheckout();
}

// ---------- abrir modal para pagamento ----------
checkoutBtn.addEventListener("click", () => {
  if (selecionados.size === 0) return;
  
  const numsArray = Array.from(selecionados).sort((a,b) => a-b);
  let displayNums = numsArray.map(n => String(n).padStart(4, "0")).join(", ");
  
  if (numsArray.length > 4) {
    displayNums = `${numsArray.length} números selecionados`;
  }
  
  const PRECO_NUMERO = 5.00; // Ajuste para o valor real da sua cota
  modalNumber.textContent = displayNums;
  modalPreco.textContent = `Total: R$ ${(numsArray.length * PRECO_NUMERO).toFixed(2).replace('.', ',')}`;
  
  modalError.textContent = "";
  nameInput.value = "";
  emailInput.value = ""; // <-- CAMPO DE EMAIL LIMPO
  whatsappInput.value = "";
  etapaDados.classList.remove("hidden");
  etapaPix.classList.add("hidden");
  modalOverlay.classList.remove("hidden");
  setTimeout(() => nameInput.focus(), 50);
});

function fecharModal() {
  modalOverlay.classList.add("hidden");
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
  const email = emailInput.value.trim(); // <-- CAPTURA DO EMAIL
  const whatsappDigitos = whatsappInput.value.replace(/\D/g, "");

  if (!nome) { modalError.textContent = "Digite seu nome."; return; }
  
  // <-- NOVA VALIDAÇÃO DE EMAIL
  if (!email || !email.includes('@')) { 
    modalError.textContent = "Digite um e-mail válido."; 
    return; 
  }

  if (whatsappDigitos.length < 10 || whatsappDigitos.length > 11) {
    modalError.textContent = "Digite um WhatsApp válido, com DDD."; return;
  }

  const numsArray = Array.from(selecionados);
  if (numsArray.length === 0) return;

  modalConfirm.disabled = true;
  modalConfirm.textContent = "Gerando Pix...";
  modalError.textContent = "";

  try {
    const resp = await fetch("/.netlify/functions/criarPagamento", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // <-- ENVIA O EMAIL NO CORPO DA REQUISIÇÃO
      body: JSON.stringify({ numerosSelecionados: numsArray, nome, email, whatsapp: whatsappDigitos }),
    });
    
    const dados = await resp.json();

    if (!resp.ok) {
      modalError.textContent = dados.erro || "Não foi possível gerar o Pix.";
      return;
    }

    numsArray.forEach(num => salvarMeuNumero(num));
    mostrarPix(numsArray, dados);
  } catch (err) {
    console.error(err);
    modalError.textContent = "Erro de conexão. Tente novamente.";
  } finally {
    modalConfirm.disabled = false;
    modalConfirm.textContent = "Gerar Pix";
  }
});

// ---------- mostrar tela do QR code ----------
function mostrarPix(numerosArray, dados) {
  etapaDados.classList.add("hidden");
  etapaPix.classList.remove("hidden");

  let displayNums = numerosArray.map(n => String(n).padStart(4, "0")).join(", ");
  if (numerosArray.length > 3) displayNums = `${numerosArray.length} números`;
  
  modalNumberPix.textContent = displayNums;
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
      pixStatus.textContent = "Tempo esgotado. Feche e escolha novamente.";
    }
  }, 1000);

  if (listenerPagamento) listenerPagamento();
  listenerPagamento = docRef.onSnapshot((snap) => {
    const dadosDoc = snap.data();
    const item = dadosDoc && dadosDoc.numeros ? dadosDoc.numeros[String(numerosArray[0])] : null;
    if (item && item.status === "pago") {
      pixStatus.textContent = "✅ Pagamento confirmado! Números garantidos.";
      clearInterval(cronometro);
      selecionados.clear(); 
      atualizarBarraCheckout();
      atualizarVisual();
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
      statusMsg.textContent = `Número ${val} está livre. Clique nele para selecionar.`;
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
    statusMsg.textContent = "Não foi possível conectar ao banco de dados.";
  }
);

// ---------- iniciar ----------
construirGrade();
atualizarVisual();

// ---------- gatilho invisível de limpeza ----------
fetch("/.netlify/functions/liberarExpirados").catch(() => {});
setInterval(() => {
  fetch("/.netlify/functions/liberarExpirados").catch(() => {});
}, 3 * 60 * 1000);
