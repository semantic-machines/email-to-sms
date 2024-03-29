## Сервис отправки SMS

### Описание сервиса
- Сервис "email-to-sms" предназначен для отправки SMS-сообщений с использованием API оператора связи.
- Источником SMS-сообщений является ящик электронной почты.
- Сервис считывает непрочитанные e-mail сообщения из ящика, формирует из них SMS и отправляет соответствующий запрос сервису оператора связи.
- Успешно обработанные (отправленные в виде SMS) e-mail сообщения удаляются из ящика электронной почты.
- Корректные сообщения, которые не были отправлены в виде SMS из-за ошибки (потеря связи, ошибки на стороне оператора, ...)
остаются в ящике непрочитанными и отправляются повторно по истечению интервала проверки.
- Некорректные сообщения (с нарушением формата) помечаются как прочитанные и остаются в ящике.
- При возникновении ошибок, сервис отправляет уведомления в выделенную telegram-группу оператора поддержки.

### Параметры сервиса
Конфигурирационный файл программы - `./conf/options.js`
- Имя сервиса: `options.name`
- Почтовый сервер: `options.exchange.server`
- Имя пользователя электронной почты: `options.exchange.user`
- Пароль пользователя электронной почты: `options.exchange.password`
- Протокол доступа к ящику: Exchange Web Services (EWS)
- Размер пачки новых писем, орабатываемых в течение интервала работы сервиса: `options.batchSize`
- Сервис отправки SMS оператора связи: `options.sms.server`
- Имя пользователя сервиса оператора: `options.sms.user`
- Пароль пользователя сервиса оператора: `options.sms.password`
- Имя отправителя SMS сервиса оператора: `options.sms.from`
- Предельный размер текста SMS-сообщения (в символах): `options.sms.messageSizeLimit`
- Интервал проверки новых e-mail сообщений: `options.timeout`
- Интервал отправки сообщений: `options.timeout / 10`
- Telegram-группа для отправки сообщений о событиях сервиса: `options.telegram.chatId`
- Telegram-бот для отправки сообщений в группу: `options.telegram.botToken`
- Количество попыток отправки сообщения в Telegram группу: `options.telegram.tries`
- Стратегия реагирования на ошибки в работе сервиса: `options.errorStrategy`
- Уровень журналирования: `options.logLevel`
- Корректный формат сообщений:
  - Тема сообщения (subject) - номера телефонов получателей в виде +71231231212 или 71231231212, разделённые точкой с запятой.
    Допускаются привычные разделители внутри номера телефона: круглые скобки, дефис, пробел.
  - Тело сообщения (body) - текст SMS. При отправке тело сообщения обрезается до предельного размера.

  Пример сообщения:
  - subject: +7 999 123 45 67; +7(999) 123-45-67
  - body: Тестовое сообщение
