import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ReviewService {
  private tempOrderStorage = new Map<string, any>();
  constructor(private readonly prismaService: PrismaService) {}
  async createReview(data: {
    orderId: number;
    nannyId: number;
    parentId: number;
    rating: number;
    comment?: string;
  }) {
    // Проверяем, существует ли уже отзыв для этого заказа
    const existingReview = await this.prismaService.review.findUnique({
      where: { orderId: data.orderId },
    });

    if (existingReview) {
      throw new Error('Отзыв для этого заказа уже существует');
    }

    // Создаем отзыв
    const review = await this.prismaService.review.create({
      data: {
        orderId: data.orderId,
        nannyId: data.nannyId,
        parentId: data.parentId,
        rating: data.rating,
        comment: data.comment,
      },
    });

    // Обновляем рейтинг няни
    await this.updateNannyRating(data.nannyId);

    return review;
  }
  async updateNannyRating(nannyId: number) {
    const stats = await this.prismaService.review.aggregate({
      where: { nannyId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    await this.prismaService.user.update({
      where: { id: nannyId },
      data: {
        avgRating: stats._avg.rating || 0,
        totalReviews: stats._count.rating || 0,
      },
    });
  }
  async getNannyReviews(nannyId: number) {
    return this.prismaService.review.findMany({
      where: { nannyId },
      include: {
        parent: {
          select: {
            fullName: true,
            phone: true,
          },
        },
        order: {
          select: {
            date: true,
            time: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  async getReviewByOrderId(orderId: number) {
    return this.prismaService.review.findUnique({
      where: { orderId },
    });
  }
  async updateReviewComment(reviewId: number, comment: string) {
    return this.prismaService.review.update({
      where: { id: reviewId },
      data: { comment },
    });
  }
  async getRecentNannyReviews(nannyId: number, limit: number = 3) {
    return this.prismaService.review.findMany({
      where: { nannyId },
      include: {
        parent: {
          select: {
            fullName: true,
          },
        },
        order: {
          select: {
            date: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
