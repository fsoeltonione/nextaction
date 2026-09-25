import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { domain } = await request.json();
    
    if (!domain) {
      return NextResponse.json({ error: "Domain is required" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

    // Fallback data if API key is missing or call fails
    const fallbackResponse = {
      name: domain,
      description: "A great SaaS product for modern teams.",
      moments: [
        { id: "account_created", label: "Account Created" },
        { id: "subscription_started", label: "Subscription Started" }
      ]
    };

    if (!apiKey) {
      return NextResponse.json({ error: "API Key is missing in .env.local" }, { status: 500 });
    }

    const prompt = `You are an expert SaaS analyst. I will give you a domain name (or URL). 
Your job is to deduce or guess what the SaaS does based on its domain name, and define commercially relevant "Moments" (semantic events that occur inside the app).

Target Domain: ${domain}

Return ONLY a valid JSON object with this exact structure:
{
  "name": "The likely name of the product (Capitalized)",
  "description": "A short 1-2 sentence description of what the SaaS likely does",
  "moments": [
    { "id": "snake_case_event_name", "label": "Human Readable Event Name" }
  ]
}

Ensure you provide 3 to 5 realistic moments (e.g. invoice_created, deal_won, repository_connected, etc based on the likely domain context). 
Output ONLY valid JSON. Do NOT wrap it in markdown code blocks like \`\`\`json.`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-v4.1-flash-free',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("LLM API Error:", errText);
      return NextResponse.json({ error: `API Provider Error: ${errText}` }, { status: response.status });
    }

    const responseText = await response.text();
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error("Failed to parse API response as JSON:", responseText);
      const match = responseText.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          data = JSON.parse(match[0]);
        } catch (innerE) {
          return NextResponse.json({ error: "Failed to parse API provider response even with regex fallback" }, { status: 500 });
        }
      } else {
        return NextResponse.json({ error: "API provider returned non-JSON response" }, { status: 500 });
      }
    }

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error("Unexpected API response structure:", data);
      return NextResponse.json({ error: "Unexpected API response structure from provider" }, { status: 500 });
    }

    let content = data.choices[0].message.content.trim();
    
    // Clean up markdown blocks just in case the model disobeys
    if (content.startsWith('```json')) content = content.substring(7);
    else if (content.startsWith('```')) content = content.substring(3);
    if (content.endsWith('```')) content = content.substring(0, content.length - 3);

    // One more try-catch for the LLM output itself
    let jsonResult;
    try {
      jsonResult = JSON.parse(content.trim());
    } catch (e) {
      console.error("LLM output is not valid JSON:", content);
      return NextResponse.json({ error: `LLM output was not valid JSON: ${content}` }, { status: 500 });
    }

    return NextResponse.json(jsonResult);

  } catch (error) {
    console.error("Error analyzing domain:", error);
    return NextResponse.json({ error: "Failed to analyze" }, { status: 500 });
  }
}
