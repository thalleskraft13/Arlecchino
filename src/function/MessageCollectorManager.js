class NextMessageCollector {

    constructor() {
        this.waiting = new Map();
    }

    handle(payload) {

        if (payload.t !== "MESSAGE_CREATE") return;

        const message = payload.d;

        const key = `${message.channel_id}_${message.author.id}`;
        const data = this.waiting.get(key);

        if (!data) return;

        if (Date.now() > data.expires) {
            this.waiting.delete(key);
            return;
        }

        clearTimeout(data.timeout);
        this.waiting.delete(key);

        data.resolve(message);
    }

    wait({ channelId, userId, time = 60000 }) {

        return new Promise((resolve, reject) => {

            const key = `${channelId}_${userId}`;

            const timeout = setTimeout(() => {
                this.waiting.delete(key);
                reject(new Error("Tempo esgotado"));
            }, time);

            this.waiting.set(key, {
                resolve,
                expires: Date.now() + time,
                timeout
            });
        });
    }
}

module.exports = NextMessageCollector;