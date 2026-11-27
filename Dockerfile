FROM nginx:1.27-alpine
WORKDIR /usr/share/nginx/html
RUN rm -f index.html
COPY *.html ./
EXPOSE 80
