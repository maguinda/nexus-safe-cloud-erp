import { BadRequestException, PipeTransform } from '@nestjs/common';

/** Los ids de la ruta solo pueden ser letras, números, guion y guion bajo (máx. 40). */
export class IdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(value)) throw new BadRequestException('Invalid id');
    return value;
  }
}
