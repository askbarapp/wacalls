import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/stores/auth";
import { toast } from "sonner";

export const LoginPage = () => {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const { login, register, isLoading } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isRegister) {
        await register(email, password, name);
        toast.success("Cuenta creada correctamente");
      } else {
        await login(email, password);
        toast.success("Sesion iniciada");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error de autenticacion");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">WaCalls</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRegister ? "Crea tu cuenta" : "Inicia sesion para continuar"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegister && (
            <div className="space-y-1.5">
              <label htmlFor="name" className="text-sm font-medium">Nombre</label>
              <Input
                id="name"
                type="text"
                placeholder="Tu nombre"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
          )}
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium">Email</label>
            <Input
              id="email"
              type="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium">Password</label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Cargando..." : isRegister ? "Crear cuenta" : "Iniciar sesion"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          {isRegister ? "Ya tienes cuenta?" : "No tienes cuenta?"}{" "}
          <button
            onClick={() => setIsRegister(!isRegister)}
            className="text-primary underline-offset-4 hover:underline font-medium"
          >
            {isRegister ? "Iniciar sesion" : "Registrate"}
          </button>
        </p>
      </div>
    </div>
  );
};
