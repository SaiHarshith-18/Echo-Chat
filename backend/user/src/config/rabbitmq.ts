import ampq from 'amqplib';

let channel: ampq.Channel;

export const connectRabbitMQ = async () => {
  try {
    const conection = await ampq.connect({
        protocol: 'amqp',
        hostname: process.env.RABBITMQ_HOST || 'localhost',
        port: parseInt(process.env.RABBITMQ_PORT || '5672'),
        username: process.env.RABBITMQ_USER,
        password: process.env.RABBITMQ_PASSWORD,
    });
    channel = await conection.createChannel();
    console.log('Connected to RabbitMQ👍');
  } catch (error) {
    console.error('Error connecting to RabbitMQ:', error);
  }
}

export const publishToQueue = async (queueName: string, message: any) => {
  if (!channel) {
    console.log('RabbitMQ channel is not established');
    return;
  }
  await channel.assertQueue(queueName, { durable: true });
  channel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
    persistent: true,
  });
}