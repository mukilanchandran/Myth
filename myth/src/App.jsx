import { useStore } from './store/useStore';
import Login from './components/Login';
import MobileSplash from './components/MobileSplash';
import Shell from './components/Shell';

// Phones skip the password: splash → straight in. Desktop keeps the lock.
// Static check on purpose — no flash of the wrong screen while hooks settle.
const isMobile = () =>
  window.matchMedia('(max-width: 768px)').matches ||
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

export default function App() {
  const authed = useStore((s) => s.authed);
  if (authed) return <Shell />;
  return isMobile() ? <MobileSplash /> : <Login />;
}
