export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Utiliza POST.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Variable de entorno GEMINI_API_KEY no configurada en Vercel.' });
  }

  try {
    const { prompt } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: 'El parámetro prompt es obligatorio.' });
    }

    const models = [
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'
    ];

    let lastError = null;

    for (const endpoint of models) {
      try {
        const response = await fetch(`${endpoint}?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: prompt }]
            }]
          })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const msg = errorData.error?.message || `HTTP ${response.status}`;
          lastError = new Error(msg);
          if (response.status === 400 || response.status === 403) {
            break;
          }
          continue;
        }

        const data = await response.json();
        const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (generatedText) {
          return res.status(200).json({ text: generatedText });
        }
      } catch (err) {
        lastError = err;
      }
    }

    return res.status(500).json({ error: lastError?.message || 'Error al procesar la solicitud con Gemini API.' });
  } catch (error) {
    console.error('Error en Serverless Function generate-marketing:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor.' });
  }
}
