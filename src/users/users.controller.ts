import { Controller, Get, Param } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users') // базовый путь
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // получить всех пользователей
  @Get()
  getAllUsers() {
    return this.usersService.getAllUsers();
  }

  // получить одного по chatId
  @Get(':chatId')
  getUser(@Param('chatId') chatId: string) {
    return this.usersService.getByChatId(chatId);
  }
}
