import { useState, useCallback, useRef } from 'react';

export const useToast = () => {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = useCallback((msg: string, durationMs = 3200) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setToastMessage(msg);
    timerRef.current = setTimeout(() => {
      setToastMessage(null);
      timerRef.current = null;
    }, durationMs);
  }, []);

  return { toastMessage, showToast };
};
