// App.tsx
import { SafeAreaView, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <WebView
        source={{ uri: 'http://192.168.3.170:5173' }}
        allowsInlineMediaPlayback
        // iOS: 避免縮放/文字放大干擾，可視需要加上：
         injectedJavaScript={`const meta = document.createElement('meta'); meta.setAttribute('name','viewport'); meta.setAttribute('content','width=device-width, initial-scale=1, viewport-fit=cover'); document.head.appendChild(meta); true;`}
      />
    </SafeAreaView>
  );
}
