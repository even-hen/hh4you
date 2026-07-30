export const CV_SAMPLES = {
    /**
     * Valid backend developer CV — long enough (≥200 chars) to pass the length gate.
     * The LLM should map this to a backend/Node.js role.
     */
    VALID_BACKEND: `Опыт работы: 5 лет backend-разработки. Стек: Node.js, Express, PostgreSQL, SQLite, Docker, TypeScript, Redis. Разработка REST API и микросервисной архитектуры. Работал в командах от 3 до 15 человек. Опыт CI/CD (GitHub Actions, GitLab CI). Образование: МГТУ им. Баумана, специальность "Информатика и вычислительная техника", диплом специалиста 2019 г.`,

    /**
     * Valid frontend developer CV — long enough (≥200 chars) to pass the length gate.
     */
    VALID_FRONTEND: `Senior Frontend Developer. Опыт: 6 лет. Стек: React, TypeScript, HTML5, CSS3, Tailwind, Next.js, Webpack. Разработка высоконагруженных SPA-приложений. Проводил code review, менторинг junior-разработчиков. Портфолио: 3 продакшн-проекта с MAU >100k. Образование: СПбГУ, "Прикладная математика и информатика", 2018.`,

    /**
     * Gibberish / not a real CV — the LLM should throw INVALID_CV.
     * Still long enough (≥200 chars) to pass the length gate.
     */
    INVALID_GIBBERISH: `Привет я ищу работу хочу получать деньги деньги деньги деньги хочу хорошую зарплату и красивый офис хочу работать мало а получать много без опыта и без образования просто хочу денег дайте мне работу пожалуйста дайте работу.`,

    /**
     * Too short — will be rejected by the length gate (<200 chars) before LLM is called.
     */
    TOO_SHORT: `Программист. Умею кодить.`,

    /**
     * Too long — will be rejected by the length gate (>8000 chars).
     */
    TOO_LONG: 'A'.repeat(8001),
};
