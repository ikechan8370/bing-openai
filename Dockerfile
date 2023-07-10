FROM node:18

WORKDIR /bing-openai

ADD . /bing-openai

RUN npm install

CMD ["npm", "run", "start"]