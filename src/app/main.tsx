import { render } from 'preact';

import { App } from './App';
import './styles/index.css';
import type { ThemeEnvironment } from './theme/initializeTheme';
import { initializeTheme } from './theme/initializeTheme';

function readBrowserStorage(): ThemeEnvironment['storage'] {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function readBrowserMatchMedia(): ThemeEnvironment['matchMedia'] {
  if (typeof window.matchMedia !== 'function') {
    return undefined;
  }

  return (query) => {
    const media = window.matchMedia(query);

    return {
      addEventListener(_type, listener) {
        media.addEventListener('change', listener);
      },
      get matches() {
        return media.matches;
      },
      removeEventListener(_type, listener) {
        media.removeEventListener('change', listener);
      },
    };
  };
}

const root = document.getElementById('app');

if (!root) {
  throw new Error('Application root element was not found.');
}

initializeTheme({
  matchMedia: readBrowserMatchMedia(),
  root: document.documentElement,
  storage: readBrowserStorage(),
});

render(<App />, root);
