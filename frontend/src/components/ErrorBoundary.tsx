import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error inside ErrorBoundary:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 rounded-2xl bg-[#1c1b18] border border-amber-900/40 text-[#ecebe6] my-4 shadow-lg">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-amber-950/60 text-amber-400 border border-amber-800/40 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="flex-1 space-y-2">
              <h3 className="text-sm font-semibold text-amber-200">
                {this.props.fallbackTitle || 'Terjadi kesalahan rendering pada komponen ini'}
              </h3>
              <p className="text-xs text-[#a3a097] leading-relaxed">
                {this.state.error?.message || 'Error tidak diketahui saat memproses data UI.'}
              </p>
              <div className="pt-2">
                <button
                  onClick={this.handleReset}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2e2c28] hover:bg-[#383632] text-xs font-medium text-[#dedcd5] border border-[#44423d] transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Coba Muat Ulang Komponen
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
