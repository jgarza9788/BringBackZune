import '@fontsource/inter/latin-300.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import { render } from 'preact';
import { App } from './App';
import { init } from './state';
import './styles.css';

render(<App />, document.getElementById('app') as HTMLElement);
void init().catch((e: Error) => {
  const el = document.getElementById('app');
  if (el) el.textContent = `Failed to start: ${e.message}`;
});
