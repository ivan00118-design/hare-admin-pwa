import { useState } from 'react';
import { ActivityIndicator, SafeAreaView, View } from 'react-native';
import { WebView } from 'react-native-webview';

const VITE_URL = 'http://192.168.3.170:5173';

// iPhone 白字白底修正 + placeholder 可見
const INJECT_FIX = `
  (function(){
    var s = document.createElement('style');
    s.innerHTML = \`
      :root { color-scheme: light; }
      input, textarea, select {
        color:#111 !important;
        -webkit-text-fill-color:#111 !important;
        background:#fff !important;
        caret-color:#111 !important;
      }
      input::placeholder, textarea::placeholder { color:#9ca3af !important; opacity:1 !important; }
      input:-webkit-autofill, textarea:-webkit-autofill, select:-webkit-autofill { -webkit-text-fill-color:#111 !important; }
    \`;
    document.head.appendChild(s);
  })(); true;
`;

const INJECT_VIEWPORT = `
  (function(){
    if(!document.querySelector('meta[name="viewport"]')){
      var m=document.createElement('meta');
      m.name='viewport';
      m.content='width=device-width, initial-scale=1, viewport-fit=cover';
      document.head.appendChild(m);
    }
  })(); true;
`;

export default function Index() {
  const [loading, setLoading] = useState(true);
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: 'white' }}>
        {loading && (
          <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
            <ActivityIndicator />
          </View>
        )}
        <WebView
          source={{ uri: VITE_URL }}
          onLoadEnd={() => setLoading(false)}
          injectedJavaScriptBeforeContentLoaded={INJECT_FIX}
          injectedJavaScript={INJECT_VIEWPORT}
          allowsInlineMediaPlayback
          originWhitelist={['*']}
          setSupportMultipleWindows={false}
          contentInsetAdjustmentBehavior="automatic"
        />
      </View>
    </SafeAreaView>
  );
}
