# Provider Support for @revola/realtime-api

This package has been updated to support multiple AI providers beyond OpenAI, including Gemini and others.

## Event Normalization

**Provider implementations should emit events WITHOUT the `server.` prefix.**

The RealtimeAPI wrapper automatically adds the `server.` prefix to all incoming events. This keeps provider implementations simple and maintains a clean separation of concerns - providers focus on translating to the universal event format, and the wrapper handles the prefixing.

### Normalized Event Format

All server events follow this pattern:
- `server.session.created` - Session initialization
- `server.response.audio.delta` - Audio response chunks
- `server.response.text.delta` - Text response chunks
- `server.response.function_call_arguments.done` - Function call completed
- `server.response.cancelled` - Response cancelled
- `server.input_audio_buffer.speech_started` - User started speaking
- `server.response.created` - Response initiated
- `server.response.done` - Response completed
- `server.response.output_item.done` - Output item completed
- `server.conversation.item.input_audio_transcription.completed` - Transcription completed

## Provider Integration

### OpenAI
The package maintains full backward compatibility with OpenAI's Realtime API:
- Automatically uses OpenAI-specific WebSocket protocols
- Adds `Authorization: Bearer <apiKey>` header
- Adds `OpenAI-Beta: realtime=v1` header

### Gemini (or other providers)
For non-OpenAI providers:
- Uses standard WebSocket connection (no special protocols)
- No provider-specific headers
- Provider emits events without `server.` prefix (wrapper adds it automatically)

## Usage with Different Providers

### OpenAI
```javascript
import { RealtimeClient } from '@revola/realtime-api';

const client = new RealtimeClient({
  apiKey: 'your-openai-api-key',
  url: 'wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview'
});

await client.connect();
```

### Custom Provider (e.g., relay server)
```javascript
import { RealtimeClient } from '@revola/realtime-api';

const client = new RealtimeClient({
  url: 'wss://your-relay-server.com/websocket'
  // No apiKey needed if your relay server handles authentication differently
});

await client.connect();
```

## Event Listening

Listen for all server events:
```javascript
client.realtime.on('server.*', (event) => {
  console.log('Received event:', event.type);
});
```

Listen for specific events:
```javascript
client.realtime.on('server.response.audio.delta', (event) => {
  // Handle audio delta
  const audioData = event.delta;
});

client.realtime.on('server.response.text.delta', (event) => {
  // Handle text delta
  const textData = event.delta;
});
```

## Provider Normalization Layer

If you're implementing a new provider, emit events WITHOUT the `server.` prefix:

```javascript
// Example: Gemini provider event normalizer
class EventNormalizer {
  normalizeAudioContent(event) {
    return {
      type: 'response.audio.delta',  // NO server. prefix - wrapper adds it
      event_id: this.generateEventId(),
      response_id: event.responseId,
      item_id: event.itemId,
      delta: event.audio
    };
  }
}
```

The RealtimeAPI wrapper will automatically convert `response.audio.delta` → `server.response.audio.delta`.

## Migration from OpenAI-specific package

If you're migrating from `@openai/realtime-api-beta`:

1. Update package name to `@revola/realtime-api`
2. No code changes required - full backward compatibility maintained
3. You can now connect to any provider, not just OpenAI

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Application Layer                     │
│          (agent-worker.js, frontend, etc.)              │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ Listens for server.* events
                     │
┌────────────────────▼────────────────────────────────────┐
│              @revola/realtime-api                       │
│  ┌──────────────────────────────────────────────┐      │
│  │  RealtimeClient / RealtimeAPI                │      │
│  │  - Receives events from WebSocket            │      │
│  │  - Auto-prefixes with "server." if needed    │      │
│  │  - Dispatches to event listeners             │      │
│  └──────────────────────────────────────────────┘      │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ WebSocket connection
                     │
        ┌────────────┴─────────────┐
        │                          │
┌───────▼────────┐      ┌─────────▼──────────┐
│ OpenAI API     │      │ Relay Server       │
│                │      │ (Provider Factory) │
│ - Raw events   │      │                    │
│ - No prefix    │      │ ┌────────────────┐ │
│                │      │ │ Gemini Provider│ │
└────────────────┘      │ │ - Normalizer   │ │
                        │ │ - Adds prefix  │ │
                        │ └────────────────┘ │
                        │                    │
                        │ ┌────────────────┐ │
                        │ │ OpenAI Provider│ │
                        │ │ - Pass-through │ │
                        │ └────────────────┘ │
                        └────────────────────┘
```

## Testing

Test with different providers:
```bash
# Test with OpenAI
PROVIDER=openai npm test

# Test with custom relay server
PROVIDER=relay npm test
```
