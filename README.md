# EE31 WebSocket Client

WebSocket client for communicating with our EE31 arduino

### Connecting to Server
- Enter a Server ID in the "Connect to Server" section
- Click "Connect" to establish WebSocket connection
- Connection status will show "Connected" when successful

### Sending Messages
- Type your message in the "Send a Message" section
- Click "Send" to transmit the message
- Sent messages appear with `[SENT]` prefix

### Viewing Messages
- Incoming messages display with `[RECEIVED]` prefix
- Messages are filtered by Server ID
- Shows last 5 messages in chronological order

## 🛠️ Technical Details

- **WebSocket Server**: `ws://34.28.153.91`
- **Message Queue**: Maintains last 5 messages
- **Filtering**: Server ID substring matching
- **Browser Support**: Modern browsers with WebSocket support

**EE31 Project Team**
- **Jonah**
- **Paul**
- **Michael**
- **Daniel**

## File Structure

```
ee31-webclient/
├── index.html       
├── styles.css         
├── index.js        
└── README.md         
```