#!/usr/bin/env python3
"""Convierte «Data para Proveedor ERP.xlsx» (carpeta PROYECTO_NEXUS de la docente) en los tres JSON del inventario de red que carga prisma/seed.ts.

Uso: python3 prisma/data/convert-network.py "<ruta>/Data para Proveedor ERP.xlsx"
Requiere openpyxl. Lee tres hojas: «01 Inventario» (dispositivos), «03 Enlaces» (enlaces) y «06 Monitoreo» (estado de monitoreo de los equipos de
infraestructura). Las demás hojas (interfaces, VLAN/DHCP, IP/MAC, equipos core) no se cargan.
"""
import json, os, sys
import openpyxl

src = sys.argv[1]
out = os.path.dirname(os.path.abspath(__file__))
wb = openpyxl.load_workbook(src, read_only=True, data_only=True)

def rows(sheet):
    r = [x for x in wb[sheet].iter_rows(values_only=True) if any(c is not None for c in x)]
    return r[0], r[1:]

def text(v):
    return None if v is None else str(v).strip() or None

def number(v):
    return None if v is None else float(v)

def yes(v):
    return {'Sí': True, 'No aparece': False}[v]  # cualquier otro valor es un error de datos: que reviente aquí y no en la base

# --- dispositivos (hoja 01) ---
_, inv = rows('01 Inventario')
devices = [{
    'id': int(r[0]), 'name': text(r[1]), 'ptType': text(r[2]), 'model': text(r[3]), 'category': text(r[4]), 'role': text(r[5]),
    'criticality': text(r[6]), 'serial': text(r[7]), 'ips': text(r[10]), 'gateways': text(r[12]),
} for r in inv]

# --- enlaces (hoja 03) ---
_, lnk = rows('03 Enlaces')
links = [{
    'id': int(r[0]), 'originName': text(r[1]), 'originPort': text(r[2]), 'destinationName': text(r[3]), 'destinationPort': text(r[4]),
    'linkType': text(r[5]), 'cableType': text(r[6]), 'functional': None if r[7] is None else (str(r[7]).lower() == 'true'),
    'length': number(r[8]), 'criticality': text(r[9]),
} for r in lnk]

# --- monitoreo de los equipos de infraestructura (hoja 06) ---
head, mon = rows('06 Monitoreo')
signal_names = [str(h) for h in head[8:]]  # CPU, Memoria, ... Hardware: lo que SE PUEDE monitorear
monitoring = [{
    'deviceName': text(r[0]), 'syslog': yes(r[4]), 'snmp': yes(r[5]), 'ntp': yes(r[6]), 'netflow': yes(r[7]),
    'signals': [n for n, v in zip(signal_names, r[8:]) if v == 'Sí'],
} for r in mon]

names = {d['name'] for d in devices}
assert len(devices) == 76 and len({d['id'] for d in devices}) == 76 and len(names) == 76, 'inventario: se esperaban 76 dispositivos distintos'
assert len(links) == 74 and len({l['id'] for l in links}) == 74, 'enlaces: se esperaban 74'
assert all(l['originName'] in names and l['destinationName'] in names for l in links), 'un enlace apunta a un dispositivo que no está en el inventario'
assert len(monitoring) == 10 and all(m['deviceName'] in names for m in monitoring), 'monitoreo: se esperaban 10 equipos del inventario'
assert len({m['deviceName'] for m in monitoring}) == 10, 'monitoreo: equipo repetido'

def dump(name, data):
    with open(os.path.join(out, name), 'w', encoding='utf-8') as f:
        f.write('[\n' + ',\n'.join(json.dumps(x, ensure_ascii=False, separators=(',', ':')) for x in data) + '\n]\n')

dump('network-devices.json', devices); dump('network-links.json', links); dump('network-monitoring.json', monitoring)
print(f'{len(devices)} dispositivos, {len(links)} enlaces, {len(monitoring)} equipos con monitoreo ({len(signal_names)} señales posibles)')
