import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { Home } from './pages/Home';
import { Editor } from './pages/Editor';

function useHashRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}



const App: React.FC = () => {
  const hash = useHashRoute();
  const m = /^#\/p\/([a-z0-9]+)/.exec(hash);
  return m ? <Editor key={m[1]} projectId={m[1]} /> : <Home />;
};

createRoot(document.getElementById('root')!).render(<App />);
