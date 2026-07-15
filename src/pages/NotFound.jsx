import { Link } from "react-router-dom";
import { Target, Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-6"
      style={{ backgroundColor: "#F8FAFC" }}>

      <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 shadow-lg">
        <Target size={32} className="text-white" />
      </div>

      <div className="text-center">
        <p className="text-8xl font-black text-gray-200 leading-none select-none">404</p>
        <h1 className="text-xl font-bold text-gray-900 mt-2">Página não encontrada</h1>
        <p className="text-sm text-gray-500 mt-1 max-w-xs">
          A rota que você tentou acessar não existe ou foi movida.
        </p>
      </div>

      <Link
        to="/"
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
      >
        <Home size={15} />
        Voltar ao Dashboard
      </Link>
    </div>
  );
}
