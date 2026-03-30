const { connect } = require('puppeteer-real-browser');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function iniciarScraper() {
    console.log('--- Operação Dismatal: Ativando Menu via Hover ---');

    const { browser, page } = await connect({
        args: ["--start-maximized", "--no-sandbox"],
        headless: false,
        customConfig: {},
        skipTargetCheck: true
    });

    try {
        await page.setUserAgent(process.env.USER_AGENT_REAL);
        await page.setViewport({ width: 1366, height: 768 });

        console.log('Passo 1: Carregando Home...');
        await page.goto('https://b2b.dismatal.com.br/', { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(res => setTimeout(res, 5000));

        console.log('Passo 2: Movendo mouse para o Login...');
        
        // Localiza as coordenadas do botão "Olá, faça seu login"
        const loginHandle = await page.evaluateHandle(() => {
            const elements = [...document.querySelectorAll('span, a, div')];
            const target = elements.find(el => el.innerText.includes('Olá, faça seu login'));
            return target ? (target.closest('a') || target) : null;
        });

        if (loginHandle) {
            const box = await loginHandle.boundingBox();
            if (box) {
                // 🚩 O PULO DO GATO: Move o mouse e "paira" antes de clicar
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                console.log('Mouse posicionado. Aguardando ativação do menu...');
                await new Promise(res => setTimeout(res, 2000));
                
                await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                console.log('Clique executado.');
            }
        }

        console.log('Aguardando 7 segundos pelo formulário...');
        await new Promise(res => setTimeout(res, 7000));
        await page.screenshot({ path: '01-pos-clique.png' });

        // Passo 3: Preenchimento (Mesmo que o modal seja "invisível" no HTML, tentamos focar)
        console.log('Tentando focar nos campos de login...');
        
        // Espera por qualquer input de senha que aparecer
        await page.waitForSelector('input[type="password"]', { timeout: 10000 });

        const inputs = await page.$$('input');
        for (let input of inputs) {
            const type = await (await input.getProperty('type')).jsonValue();
            const visible = await input.boundingBox();
            
            if (visible) {
                if (type === 'text' || type === 'email') {
                    await input.click({ clickCount: 3 });
                    await input.type(process.env.DISMATAL_USER, { delay: 100 });
                } else if (type === 'password') {
                    await input.type(process.env.DISMATAL_PASS, { delay: 100 });
                }
            }
        }

        await page.screenshot({ path: '02-dados-inseridos.png' });
        await page.keyboard.press('Enter');
        
        console.log('Processando login...');
        await new Promise(res => setTimeout(res, 15000));

        // Navegação final para o produto
        console.log('Passo 4: Verificando preço do produto...');
        await page.goto('https://b2b.dismatal.com.br/produtos/1135574', { waitUntil: 'networkidle2' });
        await new Promise(res => setTimeout(res, 10000));
        await page.screenshot({ path: '03-resultado.png' });

        const precoFinal = await page.evaluate(() => {
            const matches = document.body.innerText.match(/R\$\s?([0-9.,]+)/);
            return matches ? matches[0] : null;
        });

        if (precoFinal) {
            const valor = parseFloat(precoFinal.replace(/[^\d,]/g, '').replace(',', '.'));
            console.log(`✅ SUCESSO! R$ ${valor} capturado.`);
            
            await supabase.from('precos_dismatal').insert({
                sku: '1135574',
                nome_produto: 'Disjuntor Dismatal',
                preco: valor,
                url: 'https://b2b.dismatal.com.br/produtos/1135574'
            });
        } else {
            console.log('❌ O preço não apareceu. O login pode ter falhado ou expirado.');
            process.exit(1);
        }

    } catch (err) {
        console.error('ERRO:', err.message);
        await page.screenshot({ path: 'erro-diagnostico.png' });
        process.exit(1);
    } finally {
        await browser.close();
    }
}

iniciarScraper();
