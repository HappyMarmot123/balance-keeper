import { handleVercelRequest } from '../src/server/runtime';

export default {
  fetch(request: Request): Promise<Response> {
    return handleVercelRequest(request);
  },
};
