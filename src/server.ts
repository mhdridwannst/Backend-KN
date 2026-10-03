import app from './app';
import { env } from './config/env';
import { prisma } from './config/database';

const PORT = env.PORT;

async function bootstrap() {
  try {
    // Verifikasi koneksi basis data
    await prisma.$connect();
    console.log('✅ Connected to PostgreSQL database successfully.');

    const server = app.listen(PORT, () => {
      console.log(`🚀 POS & Inventory Backend API running on http://localhost:${PORT}`);
      console.log(`📡 Environment: ${env.NODE_ENV}`);
    });

    // Graceful Shutdown handling
    const shutdown = async (signal: string) => {
      console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
      server.close(async () => {
        console.log('🔒 HTTP server closed.');
        await prisma.$disconnect();
        console.log('🔌 Database disconnected.');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('❌ Failed to start the server:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

bootstrap();
