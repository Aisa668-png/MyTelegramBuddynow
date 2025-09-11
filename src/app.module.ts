import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'; // ✅ импорт ConfigModule
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BotModule } from './bot/bot.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // Подключаем ConfigModule глобально
    ConfigModule.forRoot({
      isGlobal: true, // переменные окружения доступны во всех модулях
    }),
    BotModule,
    UsersModule, // твой модуль бота
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
