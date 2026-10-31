#!/bin/sh
# Crea el PRIMER gerente de un servidor de producción (no hay usuarios de demostración). La contraseña se pide por teclado (no queda en el historial ni en los procesos).
# Uso: ./scripts/create-admin.sh correo@empresa.com "Nombre Apellido"
# Si ya hay un gerente, no hace nada: los demás usuarios se crean desde la pantalla «Usuarios» con esa cuenta.
set -e
cd "$(dirname "$0")/.."
EMAIL="${1:?Dime el correo del gerente}"; NAME="${2:?Dime el nombre completo}"
printf 'Contraseña (mínimo 12 caracteres): '; stty -echo 2>/dev/null || true; read -r PW; stty echo 2>/dev/null || true; echo
printf 'Repite la contraseña: '; stty -echo 2>/dev/null || true; read -r PW2; stty echo 2>/dev/null || true; echo
[ "$PW" = "$PW2" ] || { echo "No coinciden"; exit 1; }
printf '%s' "$PW" | docker compose exec -T -e ADMIN_EMAIL="$EMAIL" -e ADMIN_NAME="$NAME" identity node -e '
const { PrismaClient } = require("@prisma/client"); const { hash } = require("bcryptjs");
(async () => {
  let pw = ""; for await (const c of process.stdin) pw += c;
  const email = process.env.ADMIN_EMAIL.trim().toLowerCase(), name = process.env.ADMIN_NAME.trim().replace(/\s+/g, " ");
  if (!/^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/.test(email)) throw new Error("correo no válido");
  if (name.length < 2 || name.length > 120) throw new Error("el nombre debe tener de 2 a 120 caracteres");
  if (pw.length < 12 || pw.length > 72 || /^\s|\s$/.test(pw)) throw new Error("la contraseña debe tener de 12 a 72 caracteres y no empezar ni terminar con espacios");
  const prisma = new PrismaClient();
  const managers = await prisma.user.count({ where: { role: "manager" } });
  if (managers > 0) { console.log("Ya hay " + managers + " gerente(s): no se crea otro. Usa la pantalla Usuarios."); await prisma.$disconnect(); return; }
  await prisma.user.create({ data: { email, name, role: "manager", passwordHash: await hash(pw, 10) } });
  console.log("Gerente creado: " + email); await prisma.$disconnect();
})().catch((e) => { console.error("Error: " + e.message); process.exit(1); });
'
