# Changelog - Provider-Agnostic Updates

## Version 1.0.0 - Provider Normalization

### Breaking Changes
None - Full backward compatibility maintained with OpenAI implementation.

### New Features

#### 1. Multi-Provider Support
The package now supports any WebSocket-based realtime API provider, not just OpenAI:
- OpenAI Realtime API (original)
- Google Gemini Live API
- Custom relay servers
- Any provider that follows the normalized event format

#### 2. Smart Event Prefix Handling
The `RealtimeAPI.receive()` method now intelligently handles events:
- Events with `server.` prefix (from provider normalization) → Used as-is
- Events without prefix (raw OpenAI format) → Automatically prefixed

**Before:**
```javascript
// Always added server. prefix, causing double-prefix issues
receive(eventName, event) {
  this.dispatch(`server.${eventName}`, event);
}
```

**After:**
```javascript
// Checks if prefix exists first
receive(eventName, event) {
  if (eventName.startsWith('server.')) {
    this.dispatch(eventName, event);  // Already prefixed
  } else {
    this.dispatch(`server.${eventName}`, event);  // Add prefix
  }
}
```

#### 3. Provider-Specific Connection Logic
Connection logic now adapts based on the endpoint:

**OpenAI Endpoints** (`wss://api.openai.com`):
- Uses OpenAI-specific WebSocket protocols
- Adds `Authorization: Bearer <apiKey>` header
- Adds `OpenAI-Beta: realtime=v1` header
- Enforces API key browser restrictions

**Other Endpoints** (relay servers, Gemini, etc.):
- Standard WebSocket connection
- No special protocols
- No provider-specific headers
- Flexible authentication (handled by relay)

### Implementation Details

#### Files Modified

1. **lib/api.js**
   - Updated `constructor()` to only enforce OpenAI restrictions for OpenAI endpoints
   - Updated `connect()` to detect endpoint type and apply appropriate protocols
   - Updated `receive()` to handle pre-prefixed events
   - Added logging for different connection types

2. **Documentation**
   - Added `PROVIDER_SUPPORT.md` - Comprehensive provider integration guide
   - Added `CHANGELOG.md` - This file

### Migration Guide

#### From @openai/realtime-api-beta

No changes required! The package maintains 100% backward compatibility:

```javascript
// This still works exactly as before
import { RealtimeClient } from '@revola/realtime-api';

const client = new RealtimeClient({
  apiKey: process.env.OPENAI_API_KEY,
  url: 'wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview'
});
```

#### Using with Relay Server

```javascript
import { RealtimeClient } from '@revola/realtime-api';

// Connect to your relay server
const client = new RealtimeClient({
  url: 'wss://your-relay-server.com/websocket'
  // No apiKey needed if relay handles auth
});

await client.connect();

// Events work the same way
client.realtime.on('server.*', (event) => {
  console.log('Event:', event.type);
});
```

### Testing

Tested with:
- ✅ OpenAI Realtime API (gpt-4o-mini-realtime-preview)
- ✅ Custom relay server with OpenAI provider
- ✅ Custom relay server with Gemini provider
- ✅ Events with and without `server.` prefix

### Architecture Benefits

1. **Single Package** - One package handles all providers
2. **Zero Breaking Changes** - Existing OpenAI code works without modifications
3. **Normalized Events** - All providers emit consistent event formats
4. **Flexible Authentication** - Supports different auth mechanisms per provider
5. **Future-Proof** - Easy to add new providers (Claude, etc.)

### Event Flow

```
Provider Event → WebSocket → RealtimeAPI.receive() → Check prefix → Dispatch
                                                         ↓
                                         Has server. prefix?
                                         ↓                ↓
                                       Yes              No
                                         ↓                ↓
                                   Use as-is     Add server. prefix
                                         ↓                ↓
                                         └────────┬───────┘
                                                  ↓
                                    Dispatch to event listeners
                                                  ↓
                                    Application receives normalized event
```

### Next Steps

1. Update package.json name from `@openai/realtime-api-beta` to `@revola/realtime-api`
2. Publish to npm registry
3. Update consumer packages to use `@revola/realtime-api`
4. Consider adding TypeScript declarations for better IDE support
