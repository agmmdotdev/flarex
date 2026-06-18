import { useEffect, useState } from "react";

export function useSubscription<Value>({
  getCurrentValue,
  subscribe,
}: {
  getCurrentValue: () => Value;
  subscribe: (callback: () => void) => () => void;
}): Value {
  const [state, setState] = useState(() => ({
    getCurrentValue,
    subscribe,
    value: getCurrentValue(),
  }));

  let value = state.value;
  if (state.getCurrentValue !== getCurrentValue || state.subscribe !== subscribe) {
    value = getCurrentValue();
    setState({ getCurrentValue, subscribe, value });
  }

  useEffect(() => {
    let didUnsubscribe = false;

    const checkForUpdates = () => {
      if (didUnsubscribe) return;

      setState(previous => {
        if (previous.getCurrentValue !== getCurrentValue || previous.subscribe !== subscribe) {
          return previous;
        }

        const nextValue = getCurrentValue();
        if (previous.value === nextValue) return previous;
        return { ...previous, value: nextValue };
      });
    };

    const unsubscribe = subscribe(checkForUpdates);
    checkForUpdates();

    return () => {
      didUnsubscribe = true;
      unsubscribe();
    };
  }, [getCurrentValue, subscribe]);

  return value;
}
