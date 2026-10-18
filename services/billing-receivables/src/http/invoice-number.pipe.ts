import { BadRequestException, PipeTransform } from '@nestjs/common';

/** Número de factura: INV- y 4 a 8 dígitos. Cualquier otra cosa es 400 antes de llegar a la base. */
export class InvoiceNumberPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^INV-\d{4,8}$/.test(value)) throw new BadRequestException('Invalid invoice number');
    return value;
  }
}
