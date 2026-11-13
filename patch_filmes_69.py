#!/usr/bin/env python3
"""Aplicar no xena-build-step.sh restaurado do workflow cosmico 6.9."""
from pathlib import Path
p=Path('xena-build-step.sh')
s=p.read_text()
old='?db.allCategories(kind):db.platformCategories(kind,brand);'
assert s.count(old)==1, 'catalogo de plataforma nao localizado'
s=s.replace(old,'?db.allMovieCategories():db.platformCategories(kind,brand);')
old='db.query(group.title,kind,"",cap,0)'
assert s.count(old)>=1
s=s.replace(old,'(MOVIES.equals(kind)?db.queryPlatformMovies(group.title,cap):db.query(group.title,kind,"",cap,0))',1)
anchor='    public List<Group> allCategories(String kind){'
assert s.count(anchor)==1
extra='''    /** Filmes VOD da categoria, inclusive importados como TV; nunca inclui series. */
    private static final String MOVIE_VOD_SQL="(lower(address) LIKE '%/movie/%' OR lower(address) LIKE '%/vod/%' OR lower(address) LIKE '%.mp4%' OR lower(address) LIKE '%.mkv%' OR lower(address) LIKE '%.avi%' OR lower(address) LIKE '%.m4v%' OR lower(address) LIKE '%.mov%' OR lower(address) LIKE '%.webm%')";
    public List<Group> allMovieCategories(){
        ArrayList<Group> groups=new ArrayList<>();
        String sql="SELECT category,count(*) FROM channels WHERE kind='Filmes' OR (kind='TV' AND "+MOVIE_VOD_SQL+") GROUP BY category ORDER BY count(*) DESC,category";
        try(Cursor c=getReadableDatabase().rawQuery(sql,null)){
            while(c.moveToNext())groups.add(new Group(c.getString(0),c.getInt(1)));
        }
        return groups;
    }
    public List<Channel> queryPlatformMovies(String category,int limit){
        ArrayList<Channel> result=new ArrayList<>();
        String sql="SELECT c._id,c.title,c.address,c.category,c.logo,c.kind,"+
            "EXISTS(SELECT 1 FROM favorites f WHERE f.address=c.address) FROM channels c "+
            "WHERE c.category=? AND (c.kind='Filmes' OR (c.kind='TV' AND "+MOVIE_VOD_SQL+")) ORDER BY c._id LIMIT ?";
        try(Cursor c=getReadableDatabase().rawQuery(sql,new String[]{category,String.valueOf(limit)})){
            while(c.moveToNext())result.add(new Channel(c.getLong(0),c.getString(1),c.getString(2),c.getString(3),c.getString(4),c.getString(5),c.getInt(6)!=0));
        }
        return result;
    }
'''
s=s.replace(anchor,extra+anchor,1)
assert 'PlatformLinkRules.includes(brand,src.id,group.title,manuallyLinked)' in s
p.write_text(s)
print('PATCH OK: Filmes ampliados, vinculacao por plataforma preservada, series sem alteracao')
