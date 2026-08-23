import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// Without this, any unexpected render error anywhere in the tree takes
// the WHOLE app down to a blank black screen — no way back except force-
// closing and reopening the Mini App. This catches that and shows a
// simple recovery screen instead. It only catches render-time errors
// (not things like a failed fetch inside a try/catch, which components
// already handle with their own error states) — that's the one class of
// crash nothing else in this app guards against.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-app px-6 text-center text-white">
          <p className="text-lg font-bold">មានបញ្ហាបច្ចេកទេសកើតឡើង</p>
          <p className="max-w-xs text-sm text-white/50">
            សូមព្យាយាមបិទហើយបើក app ម្តងទៀត។ បើនៅតែមានបញ្ហា សូមទាក់ទង admin។
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-xl bg-[#2050D8] px-6 py-2.5 text-sm font-bold text-white transition active:scale-95"
          >
            ព្យាយាមម្តងទៀត
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
