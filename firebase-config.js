const firebaseConfig = {
  apiKey: "AIzaSyD41xVFtHKMwuH8DdiwiEOIcKcWm8FyNR0",
  authDomain: "rifa-solidaria-e06b8.firebaseapp.com",
  projectId: "rifa-solidaria-e06b8",
  storageBucket: "rifa-solidaria-e06b8.firebasestorage.app",
  messagingSenderId: "175271892846",
  appId: "1:175271892846:web:b8e64c540ea7721036d37f"
};

firebase.initializeApp(firebaseConfig);

// Preço de cada número — deve ser IGUAL ao PRECO_NUMERO definido em netlify/functions/criarPagamento.js
const PRECO_NUMERO = 2.0;

