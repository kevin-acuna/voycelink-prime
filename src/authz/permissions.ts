export const Permission = {
  CREATE_SESSION: 'create_session',
  JOIN_SESSION: 'join_session',
  END_SESSION: 'end_session',
  MANAGE_PARTICIPANTS: 'manage_participants',
  MANAGE_WHITEBOARD: 'manage_whiteboard',
  MANAGE_CHAT: 'manage_chat',
  SEND_CHAT_MESSAGE: 'send_chat_message',
  
} as const;
export type Permission = typeof Permission[keyof typeof Permission];