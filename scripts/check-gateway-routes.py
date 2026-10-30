#!/usr/bin/env python3
"""Revisa que cada ruta que un servicio expone esté declarada en el gateway (infra/gateway/nginx.conf).
Se olvidó tres veces (contratos, conteos e instalaciones): la ruta nueva responde bien en el servicio, pero el navegador recibe 404.
Uso: python3 scripts/check-gateway-routes.py   (sale con 1 si falta alguna)"""
import glob, re, sys

conf = open('infra/gateway/nginx.conf', encoding='utf8').read()
declared = set(re.findall(r'location\s+(?:\^~\s+|=\s+)?/([A-Za-z0-9_-]*)', conf))
SKIP = {'', 'health', 'docs', 'docs-json'}  # salud y documentación no pasan por el gateway
missing = {}
for f in glob.glob('services/*/src/http/*.controller.ts'):
    src = open(f, encoding='utf8').read()
    base = re.search(r"@Controller\(\s*(?:'([^']*)')?\s*\)", src)
    base = (base.group(1) or '') if base else ''
    firsts = set()
    if base: firsts.add(base.split('/')[0])
    else:
        for m in re.finditer(r"@(?:Get|Post|Put|Patch|Delete)\(\s*'([^':]*)", src):
            seg = m.group(1).split('/')[0]
            if seg: firsts.add(seg)
    for seg in firsts:
        if seg not in SKIP and seg not in declared: missing.setdefault(seg, []).append(f.split('/')[1])
for seg, svcs in sorted(missing.items()): print(f'FALTA en el gateway: /{seg}  (servicio: {", ".join(sorted(set(svcs)))})')
print('Rutas del gateway completas' if not missing else f'{len(missing)} ruta(s) sin declarar')
sys.exit(1 if missing else 0)
