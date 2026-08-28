"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.callAiProvider = void 0;
async function callAiProvider({ provider, apiKey, systemPrompt, userPrompt }) {
    switch (provider.id) {
        case 'anthropic':
            return callAnthropic(apiKey, provider.model ?? 'claude-sonnet-5', systemPrompt, userPrompt);
        case 'openai':
            return callOpenAi(apiKey, provider.model ?? 'gpt-4.1-mini', systemPrompt, userPrompt);
        case 'custom':
            return callCustomEndpoint(provider, apiKey, systemPrompt, userPrompt);
        case 'mock':
            return callMock(systemPrompt, userPrompt);
        default:
            throw new Error(`Provedor não suportado: ${provider.id}`);
    }
}
exports.callAiProvider = callAiProvider;
async function callMock(systemPrompt, userPrompt) {
    return [
        '⚠️ Modo de teste local — nenhuma IA foi chamada, nenhum crédito foi gasto.',
        'Abaixo está exatamente o que seria enviado para um provedor real.',
        '',
        '--- SYSTEM PROMPT ---',
        systemPrompt,
        '',
        '--- USER PROMPT ---',
        userPrompt,
    ].join('\n');
}
async function callAnthropic(apiKey, model, system, user) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model,
            max_tokens: 2000,
            system,
            messages: [{ role: 'user', content: user }],
        }),
    });
    if (!res.ok)
        throw new Error(`Anthropic API: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.content?.map((b) => b.text ?? '').join('\n') ?? '';
}
async function callOpenAi(apiKey, model, system, user) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
        }),
    });
    if (!res.ok)
        throw new Error(`OpenAI API: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
}
async function callCustomEndpoint(provider, apiKey, system, user) {
    if (!provider.endpoint)
        throw new Error('Endpoint personalizado não configurado.');
    const res = await fetch(provider.endpoint, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: provider.model, system, prompt: user }),
    });
    if (!res.ok)
        throw new Error(`Endpoint personalizado: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.text ?? data.content ?? JSON.stringify(data);
}
//# sourceMappingURL=providers.js.map