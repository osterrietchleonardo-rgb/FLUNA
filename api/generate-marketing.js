export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Utiliza POST.' });
  }

  try {
    const { prompt } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: 'El parámetro prompt es obligatorio.' });
    }

    const groqApiKey = process.env.GROQ_API_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;

    // 1. Intentar primero con Groq API (LLaMA 3.3 70B - Ultra Rápido y Sin Restricciones de Cuota)
    if (groqApiKey) {
      try {
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: 'Eres un Copywriter Estrella y Director Creativo de Marketing Gastronómico especializado en pizzerías de masa madre en Argentina.' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.7
          })
        });

        if (groqResponse.ok) {
          const groqData = await groqResponse.json();
          const generatedText = groqData.choices?.[0]?.message?.content;
          if (generatedText) {
            return res.status(200).json({ text: generatedText, provider: 'groq' });
          }
        } else {
          const groqErrData = await groqResponse.json().catch(() => ({}));
          console.warn('Groq API status no ok:', groqResponse.status, groqErrData);
        }
      } catch (groqErr) {
        console.warn('Error llamando a Groq API, procediendo a fallback Gemini...', groqErr);
      }
    }

    // 2. Fallback secundario a Gemini API
    if (geminiApiKey) {
      const models = [
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'
      ];

      for (const endpoint of models) {
        try {
          const response = await fetch(`${endpoint}?key=${geminiApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }]
            })
          });

          if (response.ok) {
            const data = await response.json();
            const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (generatedText) {
              return res.status(200).json({ text: generatedText, provider: 'gemini' });
            }
          }
        } catch (err) {
          console.warn('Error en fallback Gemini:', err);
        }
      }
    }

    return res.status(500).json({ error: 'No se pudo conectar con la API de Groq ni de Gemini. Verifica tus variables de entorno.' });
  } catch (error) {
    console.error('Error en Serverless Function generate-marketing:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor.' });
  }
}
