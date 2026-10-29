import { render } from 'preact';
import { App } from './ui/App';
import './ui/styles.css';

const root = document.getElementById('app')!;

if (import.meta.env.DEV && new URLSearchParams(location.search).get('harness') === 'import') {
  void import('./harness').then((m) => m.mountImportHarness(root));
} else {
  render(<App />, root);
}
