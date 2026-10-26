#!/usr/bin/env python3
"""Convierte «Datos PacketTracer.xlsx» (carpeta PROYECTO_NEXUS de la docente) en los dos JSON que carga prisma/seed.ts.

Uso: python3 prisma/data/convert-iot.py "<ruta>/Datos PacketTracer.xlsx"
Requiere openpyxl. Las marcas de tiempo del Excel no traen zona horaria: se guardan tal cual, como UTC.
Escribe iot-devices.json (hoja «Inventario Dispositivos», filas IOT-*) e iot-readings.json (hoja «IOT»).
"""
import json, os, sys
import openpyxl

src = sys.argv[1]
out = os.path.dirname(os.path.abspath(__file__))
wb = openpyxl.load_workbook(src, read_only=True, data_only=True)

def rows(sheet):
    return [r for r in wb[sheet].iter_rows(values_only=True) if any(c is not None for c in r)]

devices = []
for r in rows('Inventario Dispositivos'):
    if str(r[0] or '').startswith('IOT-'):
        devices.append({
            'id': r[0], 'name': r[1], 'kind': r[2], 'location': r[3], 'vlan': r[4], 'ipAddress': r[5], 'macAddress': r[8],
            'connection': r[10], 'readingKind': r[11], 'unit': r[12],
        })

readings = []
for r in rows('IOT')[2:]:  # la primera fila es el título y la segunda la cabecera
    readings.append({
        'id': int(r[0]), 'deviceId': r[2], 'recordedAt': str(r[1]).replace(' ', 'T') + '.000Z', 'status': r[9],
        'value': float(r[10]), 'unit': r[11], 'note': r[12],
    })

known = {d['id'] for d in devices}
assert len(devices) == 21, len(devices)
assert all(x['deviceId'] in known for x in readings), 'lectura de un dispositivo que no está en el inventario'
assert len({x['id'] for x in readings}) == len(readings), 'ids de lectura repetidos'

def dump(name, data):
    with open(os.path.join(out, name), 'w', encoding='utf-8') as f:
        f.write('[\n' + ',\n'.join(json.dumps(x, ensure_ascii=False, separators=(',', ':')) for x in data) + '\n]\n')

dump('iot-devices.json', devices)
dump('iot-readings.json', readings)
print(f'{len(devices)} dispositivos, {len(readings)} lecturas')
