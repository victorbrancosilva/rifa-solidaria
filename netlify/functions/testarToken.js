// 🔎 FUNÇÃO DE DIAGNÓSTICO TEMPORÁRIA
// Testa o MP_ACCESS_TOKEN contra o endpoint GET /v1/payment_methods do Mercado Pago.
// Não expõe o token — só mostra o status da resposta e o corpo (sem dados sensíveis).
// Depois de resolver o problema, pode apagar esse arquivo.

exports.handler = async () => {
  const token = process.env.MP_ACCESS_TOKEN;

  if (!token) {
    return {
      statusCode: 200,
      body: JSON.stringify({ erro: "MP_ACCESS_TOKEN não está definido nas variáveis de ambiente." }),
    };
  }

  try {
    const resposta = await fetch("https://api.mercadopago.com/v1/payment_methods", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const corpo = await resposta.json();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        {
          status_da_resposta: resposta.status,
          tamanho_do_token: token.length,
          comeco_do_token: token.slice(0, 8),
          resposta_do_mercado_pago: corpo,
        },
        null,
        2
      ),
    };
  } catch (err) {
    return {
      statusCode: 200,
      body: JSON.stringify({ erro: "Falha ao chamar a API", detalhe: err.message }),
    };
  }
};
