import OpenAI from 'openai';

// smoke test that importing and constructing the client works
const openai = new OpenAI({ apiKey: '<invalid API key>' });
console.log(openai);

// smoke test that making an API request works, even if it errors
openai.completions
  .create({
    prompt: 'Say this is a test',
    model: 'text-davinci-003',
  })
  .catch((err) => console.error(err));


// --------
class Greeter {
  greeting: string;
  constructor(message: string) {
    this.greeting = message;
  }
  greet(): string {
    return `Hello, ${this.greeting}`;
  }
}

const greeter = new Greeter('world');

const button = document.getElementById('myButton')!;
button.onclick = () => {
  alert(greeter.greet());
};
