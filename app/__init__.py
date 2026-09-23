from flask import Flask, jsonify

import app.config as cfg
import app.db as db
from app import pages, api_child, api_teacher, api_admin, auth


def create_app():
    app = Flask(__name__,
                template_folder='../templates',
                static_folder='../static')
    app.config['SECRET_KEY'] = cfg.SECRET
    app.config['MAX_CONTENT_LENGTH'] = 800 * 1024 * 1024  # 800 MB uploads
    db.init()

    app.register_blueprint(pages.bp)
    app.register_blueprint(api_child.bp)
    app.register_blueprint(api_teacher.bp)
    app.register_blueprint(api_admin.bp)

    app.add_url_rule('/api/auth/login', 'login', auth.api_login, methods=['POST'])
    app.add_url_rule('/api/auth/register', 'register', auth.api_register, methods=['POST'])
    app.add_url_rule('/api/auth/logout', 'logout', auth.api_logout, methods=['POST'])
    app.add_url_rule('/api/auth/lang', 'setlang', auth.api_set_lang, methods=['POST'])
    app.add_url_rule('/api/me', 'me', auth.api_me, methods=['GET'])

    @app.errorhandler(404)
    def nf(e):
        if str(e).startswith('/api/'):
            return jsonify(ok=0, error='notfound'), 404
        return jsonify(ok=0, error='notfound'), 404

    return app
