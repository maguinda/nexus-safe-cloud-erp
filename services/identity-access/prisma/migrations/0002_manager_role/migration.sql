-- Rol de gerente: solo lee el dashboard de Analytics (ninguna ruta de projects ni de billing lo admite).
ALTER TYPE "Role" ADD VALUE 'manager';
