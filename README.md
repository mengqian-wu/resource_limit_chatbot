# Limited-Resource Chatbot

This research platform uses a familiar chatbot interface to study how limits on AI access shape students’ thinking and learning. Students interact with a chatbot in Chinese while working on a writing task about generative AI and educational equity. The platform records how students prompt the chatbot and revise their writing, allowing researchers to examine how reasoning unfolds over time and compare logical thinking, self-regulated learning, and AI literacy across conditions.

## Study conditions

| Condition | Prompt budget | Participant experience |
| --- | --- | --- |
| Group A · Control | No enforced turn limit | Students can continue asking questions throughout the task. |
| Group B · Experimental | Four prompts | Students see their remaining prompts and can continue writing after the chat budget is exhausted. |

Both groups use the same DeepSeek model, task topic, and system instructions. Each model request has a maximum of 512 output tokens, and the server records prompt, completion, and total token usage for each successful exchange. The study varies the number of prompts students can submit and measures the token consumption that results. The interface displays previous exchanges, and the server sends each new prompt to the model independently.

## Implementation and research logs

- [`index.html`](index.html) provides the participant-facing chat interface, remaining-prompt indicator, and writing area.
- [`server.js`](server.js) is a Node.js and Express backend hosted on Alibaba Cloud. It applies the prompt limit, calls the DeepSeek API, and writes one newline-delimited JSON log per participant.
- Chat logs include timestamps, study condition, prompt and response text, response latency, and token counts. The platform also records interface events and saves writing drafts and final submissions. Together, these records support analysis of how students use AI across successive exchanges and during writing.

Keep participant logs and submissions private. Use synthetic data for demonstrations and keep API keys in environment variables.

## Run locally

Use Node.js 18 or later and a DeepSeek API key. From the directory containing `server.js` and `index.html`, install the backend dependencies and start the server.

```sh
npm install --no-save express cors
DEEPSEEK_API_KEY='<your-key>' node server.js
```

Set `SERVER_URL` in `index.html` to `http://localhost:3001` for local testing. In a separate terminal, serve the frontend from the same directory with `python3 -m http.server 8000 --bind 127.0.0.1`, then open [the local interface](http://127.0.0.1:8000/index.html). Use a disposable participant ID in a local copy that contains no study data.
