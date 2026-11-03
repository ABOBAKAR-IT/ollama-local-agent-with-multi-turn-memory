import express from 'express';
import ollama from 'ollama';

const app = express();
app.use(express.json());

// In-Memory Session Store (In production, replace this with Redis or a Database)
// Structure: Map<sessionId, Array of message objects>
const sessions = new Map();

// 1. Backend Tool Function
function getTheWeather(args = {}) {
    const city = args.city || 'Unknown';
    console.log(`[Backend Tool Executed] Fetching weather for: ${city}`);

    if (city.toLowerCase() === 'lahore') {
        return JSON.stringify({ temperature: '18°C', condition: 'Partly Cloudy' });
    }
    return JSON.stringify({ temperature: '22°C', condition: 'Sunny' });
}

// 2. Tool Definition Schema
const weatherToolDefinition = {
    type: 'function',
    function: {
        name: 'getTheWeather',
        description: 'Get the current weather for a given city.',
        parameters: {
            type: 'object',
            properties: {
                city: {
                    type: 'string',
                    description: 'The city name, e.g. London, Lahore, Tokyo',
                },
            },
            required: ['city'],
        },
    },
};

// 3. Agent Endpoint with Session Memory
app.post('/api/agent', async (req, res) => {
    try {
        const { sessionId, prompt } = req.body;

        if (!sessionId || !prompt) {
            return res.status(400).json({ error: 'Both "sessionId" and "prompt" are required in the request body.' });
        }

        // Retrieve existing history for this session, or initialize a new array if it's a new session
        if (!sessions.has(sessionId)) {
            sessions.set(sessionId, []);
        }
        const messages = sessions.get(sessionId);

        // Append the new user prompt to the session's history
        messages.push({ role: 'user', content: prompt });

        console.log(`\n[Session: ${sessionId}] Prompt Received: "${prompt}"`);
        console.log(`Current message history length: ${messages.length}`);

        // First call to Ollama (with full history & tools)
        const response = await ollama.chat({
            model: 'qwen3:4b', // Make sure this matches your installed model or 'llama3.2:1b'
            messages: messages,
            tools: [weatherToolDefinition],
        });

        // Push assistant's intermediate response (which might contain tool calls) to history
        messages.push(response.message);

        // Check if the model triggered a tool call
        if (response.message.tool_calls && response.message.tool_calls.length > 0) {
            for (const toolCall of response.message.tool_calls) {
                const functionName = toolCall.function.name;
                const functionArgs = toolCall.function.arguments;

                console.log(`-> LLM called tool: "${functionName}" with args:`, functionArgs);

                if (functionName === 'getTheWeather') {
                    const toolResultJson = getTheWeather(functionArgs);
                    console.log(`-> Tool returned data:`, toolResultJson);

                    // Append tool output to history
                    messages.push({
                        role: 'tool',
                        content: toolResultJson,
                    });
                }
            }

            console.log('Sending tool results back to Ollama for final formulation...');

            // Second call to Ollama with the tool results appended
            const finalResponse = await ollama.chat({
                model: 'qwen3:4b',
                messages: messages,
            });

            // Push final assistant response to history
            messages.push(finalResponse.message);

            return res.json({
                success: true,
                sessionId,
                response: finalResponse.message.content,
            });
        }

        // If no tool was needed, return direct response and save it
        return res.json({
            success: true,
            sessionId,
            response: response.message.content,
        });

    } catch (error) {
        console.error('Agent Error:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

const PORT = 6000;
app.listen(PORT, () => {
    console.log(`🚀 Stateful Agent Express Server running on http://localhost:${PORT}`);
});