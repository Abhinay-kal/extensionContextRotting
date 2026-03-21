import { FloatingUI } from '../components/FloatingUI';
import { AuthProvider } from '../auth/AuthProvider';
import type { LLMDOMStrategy } from '../interfaces/LLMDOMStrategy';

export function App({ strategy }: { strategy: LLMDOMStrategy }): JSX.Element {
  return (
    <AuthProvider>
      <FloatingUI strategy={strategy} />
    </AuthProvider>
  );
}
